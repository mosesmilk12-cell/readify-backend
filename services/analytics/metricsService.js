const admin = require("../../config/firebase");

function getDb() {
  if (!admin.apps.length) return null;
  try { return admin.firestore(); } catch (_) { return null; }
}

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function utcMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

async function recordAiEvent(event) {
  const db = getDb();
  if (!db) {
    console.warn("[Analytics] Firestore unavailable; event not persisted", event.requestId);
    return false;
  }

  const now = new Date();
  const dayKey = utcDayKey(now);
  const monthKey = utcMonthKey(now);
  const eventRef = db.collection("aiCostEvents").doc(event.requestId);
  const dailyRef = db.collection("aiMetricsDaily").doc(dayKey);
  const monthlyRef = db.collection("aiMetricsMonthly").doc(monthKey);
  const FieldValue = admin.firestore.FieldValue;
  const feature = event.feature || "unknown";
  const cached = event.cached === true;
  const success = event.success !== false;
  const cost = Number(event.estimatedCostUsd || 0);

  const eventPayload = {
    ...event,
    uid: event.uid || null,
    createdAt: FieldValue.serverTimestamp(),
    dayKey,
    monthKey,
  };

  const aggregateUpdate = {
    totalRequests: FieldValue.increment(1),
    cacheHits: FieldValue.increment(cached ? 1 : 0),
    cacheMisses: FieldValue.increment(cached ? 0 : 1),
    successfulRequests: FieldValue.increment(success ? 1 : 0),
    failedRequests: FieldValue.increment(success ? 0 : 1),
    estimatedCostUsd: FieldValue.increment(cost),
    [`features.${feature}.requests`]: FieldValue.increment(1),
    [`features.${feature}.costUsd`]: FieldValue.increment(cost),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(eventRef, eventPayload, { merge: true });
  batch.set(dailyRef, aggregateUpdate, { merge: true });
  batch.set(monthlyRef, aggregateUpdate, { merge: true });
  await batch.commit();
  return true;
}

module.exports = { recordAiEvent, utcDayKey, utcMonthKey };
