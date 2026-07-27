const admin = require("../../config/firebase");

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function utcMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function increment(value) {
  return admin.firestore.FieldValue.increment(value);
}

async function recordAiMetric(event) {
  if (process.env.AI_ANALYTICS_ENABLED === "false") return;
  if (!admin.apps.length) return;

  const db = admin.firestore();
  const now = new Date();
  const dateKey = utcDateKey(now);
  const monthKey = utcMonthKey(now);
  const feature = event.feature || "unknown";
  const cached = event.cached === true;
  const cost = Number(event.estimatedCostUsd || 0);
  const inputTokens = Number(event.inputTokens || 0);
  const outputTokens = Number(event.outputTokens || 0);
  const totalTokens = Number(event.totalTokens || inputTokens + outputTokens);

  const payload = {
    requestId: event.requestId,
    uid: event.uid || null,
    feature,
    model: event.model || null,
    cached,
    success: event.success !== false,
    durationMs: Number(event.durationMs || 0),
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: cost,
    errorCode: event.errorCode || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const dailyRef = db.collection("aiMetricsDaily").doc(dateKey);
  const monthlyRef = db.collection("aiMetricsMonthly").doc(monthKey);
  const eventRef = db.collection("aiCostEvents").doc(event.requestId);

  const common = {
    totalRequests: increment(1),
    successfulRequests: increment(payload.success ? 1 : 0),
    failedRequests: increment(payload.success ? 0 : 1),
    cacheHits: increment(cached ? 1 : 0),
    cacheMisses: increment(cached ? 0 : 1),
    totalInputTokens: increment(inputTokens),
    totalOutputTokens: increment(outputTokens),
    totalTokens: increment(totalTokens),
    estimatedCostUsd: increment(cost),
    [`features.${feature}.requests`]: increment(1),
    [`features.${feature}.costUsd`]: increment(cost),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const batch = db.batch();
    batch.set(eventRef, payload, { merge: true });
    batch.set(dailyRef, { dateKey, ...common }, { merge: true });
    batch.set(monthlyRef, { monthKey, ...common }, { merge: true });
    await batch.commit();
  } catch (error) {
    console.warn("[AI Analytics] metric write failed:", error.message);
  }
}

module.exports = { recordAiMetric, utcDateKey, utcMonthKey };
