"use strict";

const express = require("express");
const router  = express.Router();

const admin = require("../config/firebase");
const requireAdmin = require("../middleware/requireAdmin");
const { getBudgetStatus, getLimits } = require("../services/analytics/budgetService");
const { utcDayKey, utcMonthKey }     = require("../services/analytics/metricsService");
const { getDailyUsage }              = require("../services/usage/usageService");
const { FEATURE_RULES, resolveQuota } = require("../services/usage/quotaRules");

// Everything below the mount point is admin-only.
router.use("/admin", requireAdmin);

function db() {
  if (!admin.apps.length) throw new Error("Firebase Admin is not configured.");
  return admin.firestore();
}

function emptyMetrics(key) {
  return {
    key,
    totalRequests: 0, successfulRequests: 0, failedRequests: 0,
    cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0,
    features: {},
  };
}

function shapeMetrics(snapshot, key) {
  if (!snapshot.exists) return emptyMetrics(key);
  const d = snapshot.data();
  return {
    key,
    totalRequests:      d.totalRequests      || 0,
    successfulRequests: d.successfulRequests || 0,
    failedRequests:     d.failedRequests     || 0,
    cacheHits:          d.cacheHits          || 0,
    cacheMisses:        d.cacheMisses        || 0,
    estimatedCostUsd:   Number((d.estimatedCostUsd || 0).toFixed(6)),
    features:           d.features           || {},
    updatedAt:          d.updatedAt          || null,
  };
}

// ── GET /api/admin/overview ────────────────────────────────────────────────
// Single call that powers the Console home screen.
router.get("/admin/overview", async (req, res) => {
  try {
    const dayKey   = utcDayKey();
    const monthKey = utcMonthKey();

    const [daySnap, monthSnap, budget] = await Promise.all([
      db().collection("aiMetricsDaily").doc(dayKey).get(),
      db().collection("aiMetricsMonthly").doc(monthKey).get(),
      getBudgetStatus({ force: true }),
    ]);

    const today = shapeMetrics(daySnap, dayKey);
    const month = shapeMetrics(monthSnap, monthKey);

    const cacheTotal = today.cacheHits + today.cacheMisses;

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      today,
      month,
      budget,
      derived: {
        // Cache hit rate is the cheapest cost lever there is — surface it.
        cacheHitRateToday: cacheTotal > 0
            ? Number(((today.cacheHits / cacheTotal) * 100).toFixed(1)) : 0,
        errorRateToday: today.totalRequests > 0
            ? Number(((today.failedRequests / today.totalRequests) * 100).toFixed(1)) : 0,
        avgCostPerRequestToday: today.totalRequests > 0
            ? Number((today.estimatedCostUsd / today.totalRequests).toFixed(6)) : 0,
      },
    });
  } catch (err) {
    console.error("[admin/overview]", err.message);
    return res.status(500).json({ success: false, error: "Could not load the overview." });
  }
});

// ── GET /api/admin/metrics/daily?date=YYYY-MM-DD&days=7 ────────────────────
router.get("/admin/metrics/daily", async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 60);
    const end  = req.query.date ? new Date(`${req.query.date}T00:00:00Z`) : new Date();
    if (Number.isNaN(end.getTime())) {
      return res.status(400).json({ success: false, error: "Invalid date." });
    }

    const keys = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - i);
      keys.push(utcDayKey(d));
    }

    const snaps = await db().getAll(
        ...keys.map(k => db().collection("aiMetricsDaily").doc(k)));

    const series = snaps.map((s, i) => shapeMetrics(s, keys[i]));

    return res.json({
      success: true,
      range: { from: keys[0], to: keys[keys.length - 1], days },
      totals: {
        requests: series.reduce((a, d) => a + d.totalRequests, 0),
        costUsd:  Number(series.reduce((a, d) => a + d.estimatedCostUsd, 0).toFixed(6)),
      },
      series,
    });
  } catch (err) {
    console.error("[admin/metrics/daily]", err.message);
    return res.status(500).json({ success: false, error: "Could not load daily metrics." });
  }
});

// ── GET /api/admin/metrics/monthly?month=YYYY-MM ───────────────────────────
router.get("/admin/metrics/monthly", async (req, res) => {
  try {
    const monthKey = req.query.month || utcMonthKey();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ success: false, error: "Invalid month. Use YYYY-MM." });
    }
    const snap = await db().collection("aiMetricsMonthly").doc(monthKey).get();
    return res.json({ success: true, month: shapeMetrics(snap, monthKey) });
  } catch (err) {
    console.error("[admin/metrics/monthly]", err.message);
    return res.status(500).json({ success: false, error: "Could not load monthly metrics." });
  }
});

// ── GET /api/admin/budget ──────────────────────────────────────────────────
router.get("/admin/budget", async (req, res) => {
  try {
    const status = await getBudgetStatus({ force: true });
    return res.json({ success: true, limits: getLimits(), status });
  } catch (err) {
    console.error("[admin/budget]", err.message);
    return res.status(500).json({ success: false, error: "Could not load budget status." });
  }
});

// ── GET /api/admin/users/:uid/usage ────────────────────────────────────────
// Per-user view: subscription tier plus today's AI consumption.
router.get("/admin/users/:uid/usage", async (req, res) => {
  try {
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ success: false, error: "Missing uid." });

    const [profileSnap, usage] = await Promise.all([
      db().collection("users").doc(uid).get(),
      getDailyUsage({ uid }),
    ]);

    const profile = profileSnap.exists ? profileSnap.data() : {};
    const tier    = profile.subscriptionTier || "FREE";
    const isPremium = tier === "PREMIUM" || tier === "LITE_YEARLY";

    const features = {};
    for (const feature of Object.keys(FEATURE_RULES)) {
      features[feature] = resolveQuota({ feature, usage, isPremium });
    }

    return res.json({
      success: true,
      uid,
      subscription: {
        tier,
        plan:      profile.subscriptionPlan || null,
        expiresAt: profile.premiumExpiryMs  || null,
        trialUsed: profile.freeTrialUsed === true,
      },
      usageToday: features,
    });
  } catch (err) {
    console.error("[admin/users/usage]", err.message);
    return res.status(500).json({ success: false, error: "Could not load user usage." });
  }
});

// ── GET /api/admin/events/recent?limit=50 ──────────────────────────────────
// Raw request log — the debugging view.
router.get("/admin/events/recent", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    let query = db().collection("aiCostEvents")
                    .orderBy("createdAt", "desc")
                    .limit(limit);

    if (req.query.feature) query = db().collection("aiCostEvents")
                    .where("feature", "==", String(req.query.feature))
                    .orderBy("createdAt", "desc")
                    .limit(limit);

    const snap = await query.get();
    const events = snap.docs.map(doc => {
      const d = doc.data();
      return {
        requestId:        doc.id,
        uid:              d.uid || null,
        feature:          d.feature || "unknown",
        model:            d.model || null,
        cached:           d.cached === true,
        success:          d.success !== false,
        inputTokens:      d.inputTokens  || 0,
        outputTokens:     d.outputTokens || 0,
        estimatedCostUsd: d.estimatedCostUsd || 0,
        durationMs:       d.durationMs || null,
        error:            d.error || null,
        createdAt:        d.createdAt || null,
      };
    });

    return res.json({ success: true, count: events.length, events });
  } catch (err) {
    // A missing composite index is the usual cause here — say so plainly.
    console.error("[admin/events/recent]", err.message);
    return res.status(500).json({
      success: false,
      error: "Could not load recent events. If you filtered by feature, " +
             "Firestore may need a composite index (feature + createdAt).",
    });
  }
});

module.exports = router;
