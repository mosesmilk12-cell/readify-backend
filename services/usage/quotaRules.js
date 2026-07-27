"use strict";

const FEATURE_RULES = Object.freeze({
  summary: Object.freeze({ usedField: "summariesUsed", bonusField: "summaryBonus", dailyLimit: 5 }),
  quiz: Object.freeze({ usedField: "quizzesUsed", bonusField: "quizBonus", dailyLimit: 5 }),
  voice: Object.freeze({ usedField: "voiceUnitsUsed", bonusField: "voiceBonus", dailyLimit: 5 }),
  tutor: Object.freeze({ usedField: "tutorUses", bonusField: "tutorBonus", dailyLimit: 5 }),
});

function getFeatureRule(feature) {
  const rule = FEATURE_RULES[feature];
  if (!rule) throw new Error(`Unsupported AI quota feature: ${feature}`);
  return rule;
}

function resolveQuota({ feature, usage = {}, isPremium = false }) {
  const rule = getFeatureRule(feature);
  const used = Math.max(0, Number(usage[rule.usedField]) || 0);
  const bonus = Math.max(0, Number(usage[rule.bonusField]) || 0);
  const limit = isPremium ? null : rule.dailyLimit + bonus;

  return {
    feature,
    used,
    bonus,
    limit,
    remaining: isPremium ? null : Math.max(limit - used, 0),
    unlimited: isPremium,
    exhausted: !isPremium && used >= limit,
  };
}

module.exports = { FEATURE_RULES, getFeatureRule, resolveQuota };
