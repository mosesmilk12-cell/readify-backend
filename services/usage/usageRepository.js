"use strict";

const admin = require("../../config/firebase");
const { getFeatureRule, resolveQuota } = require("./quotaRules");

function getDateKey(timeZone = process.env.AI_USAGE_TIMEZONE || "Africa/Lagos") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getUsageRef(uid, dateKey = getDateKey()) {
  if (!admin.apps.length) throw new Error("Firebase Admin is not configured.");
  return admin.firestore().collection("aiUsage").doc(uid).collection("daily").doc(dateKey);
}

async function consume({ uid, feature, units = 1, isPremium = false, enforce = false }) {
  const safeUnits = Math.max(1, Math.floor(Number(units) || 1));
  const rule = getFeatureRule(feature);
  const ref = getUsageRef(uid);
  const db = admin.firestore();

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : {};
    const before = resolveQuota({ feature, usage: current, isPremium });
    const wouldExceed = !isPremium && before.used + safeUnits > before.limit;

    if (enforce && wouldExceed) {
      return { allowed: false, recorded: false, wouldExceed: true, quota: before, dateKey: ref.id };
    }

    const nextUsed = before.used + safeUnits;
    transaction.set(ref, {
      uid,
      dateKey: ref.id,
      [rule.usedField]: nextUsed,
      updatedAt: admin.firestore.Timestamp.now(),
      createdAt: snapshot.exists
        ? (current.createdAt || admin.firestore.Timestamp.now())
        : admin.firestore.Timestamp.now(),
    }, { merge: true });

    const afterUsage = { ...current, [rule.usedField]: nextUsed };
    const after = resolveQuota({ feature, usage: afterUsage, isPremium });
    return { allowed: true, recorded: true, wouldExceed, quota: after, dateKey: ref.id };
  });
}

async function release({ uid, feature, units = 1 }) {
  const safeUnits = Math.max(1, Math.floor(Number(units) || 1));
  const rule = getFeatureRule(feature);
  const ref = getUsageRef(uid);
  const db = admin.firestore();

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const current = snapshot.data() || {};
    const used = Math.max(0, Number(current[rule.usedField]) || 0);
    transaction.set(ref, {
      [rule.usedField]: Math.max(used - safeUnits, 0),
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
  });
}

async function getDailyUsage({ uid, dateKey = getDateKey() }) {
  const snapshot = await getUsageRef(uid, dateKey).get();
  return snapshot.exists ? snapshot.data() : { uid, dateKey };
}

/**
 * Credits rewarded-ad bonus uses to the account.
 *
 * Server-side so the bonus cannot be farmed by clearing app data — the count
 * belongs to the account, not the device. `maxPerDay` caps how many bonuses a
 * user can earn in a day regardless of how many ads they manage to watch.
 */
async function grantBonus({ uid, feature, units = 1, maxPerDay = 5 }) {
  const { FEATURE_RULES } = require("./quotaRules");
  const rule = FEATURE_RULES[feature];
  if (!rule) throw new Error(`Unknown feature: ${feature}`);

  const admin = require("../../config/firebase");
  const db = admin.firestore();
  const ref = getUsageRef(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};

    const current = Math.max(0, Number(data[rule.bonusField]) || 0);
    const granted = Math.min(units, Math.max(0, maxPerDay - current));

    if (granted > 0) {
      tx.set(ref, {
        [rule.bonusField]: current + granted,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return {
      granted,
      totalBonus: current + granted,
      atLimit: current + granted >= maxPerDay,
    };
  });
}

module.exports = { consume, release, getDailyUsage, getDateKey, grantBonus };
