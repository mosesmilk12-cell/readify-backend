"use strict";

const admin = require("../../config/firebase");
const { utcDayKey, utcMonthKey } = require("./metricsService");

// ── Configuration ──────────────────────────────────────────────────────────
// All limits are in USD. 0 or unset means "no ceiling".
//   AI_DAILY_BUDGET_USD          e.g. 5
//   AI_MONTHLY_BUDGET_USD        e.g. 100
//   AI_BUDGET_WARN_PERCENT       default 80
//   AI_BUDGET_ENFORCEMENT_ENABLED  default false (monitor only)
// ───────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;   // budget is read on every AI call — cache it
let cache = { value: null, expiresAt: 0 };

function envNumber(name, fallback = 0) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function isEnforcementEnabled() {
  return envFlag("AI_BUDGET_ENFORCEMENT_ENABLED", false);
}

function getLimits() {
  return {
    dailyUsd:    envNumber("AI_DAILY_BUDGET_USD", 0),
    monthlyUsd:  envNumber("AI_MONTHLY_BUDGET_USD", 0),
    warnPercent: envNumber("AI_BUDGET_WARN_PERCENT", 80),
  };
}

function getDb() {
  if (!admin.apps.length) return null;
  try { return admin.firestore(); } catch (_) { return null; }
}

function buildWindow(spend, limit, warnPercent) {
  const percent = limit > 0 ? Number(((spend / limit) * 100).toFixed(1)) : 0;
  let status = "ok";
  if (limit > 0) {
    if (spend >= limit)               status = "exceeded";
    else if (percent >= warnPercent)  status = "warning";
  }
  return {
    spendUsd:     Number(spend.toFixed(6)),
    limitUsd:     limit,
    percentUsed:  percent,
    remainingUsd: limit > 0 ? Number(Math.max(limit - spend, 0).toFixed(6)) : null,
    status,
  };
}

/**
 * Current spend against the configured ceilings.
 * Reads the pre-aggregated aiMetricsDaily / aiMetricsMonthly documents,
 * so this stays cheap even at high request volume.
 */
async function getBudgetStatus({ force = false } = {}) {
  if (!force && cache.value && Date.now() < cache.expiresAt) {
    return { ...cache.value, cached: true };
  }

  const limits = getLimits();
  const db = getDb();

  if (!db) {
    const unavailable = {
      available: false,
      enforcement: isEnforcementEnabled(),
      daily:   buildWindow(0, limits.dailyUsd,   limits.warnPercent),
      monthly: buildWindow(0, limits.monthlyUsd, limits.warnPercent),
      status: "unknown",
    };
    return unavailable;
  }

  const dayKey   = utcDayKey();
  const monthKey = utcMonthKey();

  const [daySnap, monthSnap] = await Promise.all([
    db.collection("aiMetricsDaily").doc(dayKey).get(),
    db.collection("aiMetricsMonthly").doc(monthKey).get(),
  ]);

  const daySpend   = Number(daySnap.exists   ? daySnap.data().estimatedCostUsd   || 0 : 0);
  const monthSpend = Number(monthSnap.exists ? monthSnap.data().estimatedCostUsd || 0 : 0);

  const daily   = buildWindow(daySpend,   limits.dailyUsd,   limits.warnPercent);
  const monthly = buildWindow(monthSpend, limits.monthlyUsd, limits.warnPercent);

  // Worst of the two windows wins
  const rank = { ok: 0, warning: 1, exceeded: 2 };
  const status = rank[daily.status] >= rank[monthly.status] ? daily.status : monthly.status;

  const value = {
    available: true,
    enforcement: isEnforcementEnabled(),
    dayKey,
    monthKey,
    daily,
    monthly,
    status,
    checkedAt: new Date().toISOString(),
  };

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

  if (status !== "ok") {
    console.warn(`[Budget] ${status.toUpperCase()} — day $${daily.spendUsd}/${daily.limitUsd || "∞"}, ` +
                 `month $${monthly.spendUsd}/${monthly.limitUsd || "∞"}`);
  }

  return { ...value, cached: false };
}

/** Drops the cache so the next read hits Firestore (used after config changes). */
function invalidateCache() {
  cache = { value: null, expiresAt: 0 };
}

module.exports = {
  getBudgetStatus,
  getLimits,
  isEnforcementEnabled,
  invalidateCache,
};
