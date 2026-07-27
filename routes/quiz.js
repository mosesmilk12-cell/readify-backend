const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { generateQuizPack } = require("../services/openaiService");
const { getCache } = require("../config/cache");
const { aiQueue, queueEvents } = require("../config/queue");
const logger = require("../services/analytics/requestLogger");
const estimator = require("../services/analytics/tokenEstimator");
const { estimateTextCostUsd } = require("../services/analytics/costService");
const { recordAiEvent } = require("../services/analytics/metricsService");

router.post("/generate-quiz", async (req, res) => {
  const track = logger.start("quiz", req);
  const model = "gpt-4o-mini";
  try {
    const { title, sourceText, questionCount, difficulty, includeExplanations, questionType } = req.body || {};
    if (!sourceText || !sourceText.trim()) return res.status(400).json({ error: "sourceText is required" });

    const allowedTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];
    const resolvedType = allowedTypes.includes(questionType) ? questionType : "MULTIPLE_CHOICE";
    const count = Math.min(60, Math.max(1, Number(questionCount) || 10));
    const diff = difficulty || "Medium";
    const cached = await getCache("quiz", sourceText, String(count), diff, resolvedType);
    if (cached) {
      const output = JSON.stringify(cached);
      const tokens = estimator.estimate(sourceText, output);
      await recordAiEvent(logger.finish(track, { uid: req.user?.uid, model, cached: true, success: true, ...tokens, estimatedCostUsd: 0 }));
      return res.json(cached);
    }

    let result;
    if (aiQueue && queueEvents) {
      const jobId = "quiz-" + crypto.createHash("sha256").update(`${sourceText}|${count}|${diff}|${resolvedType}`).digest("hex").substring(0, 20);
      const job = await aiQueue.add("quiz", { title: title || "AI Generated Quiz Pack", sourceText, questionCount: count, difficulty: diff, questionType: resolvedType, premium: req.isPremium === true }, { jobId });
      result = await job.waitUntilFinished(queueEvents, 90_000);
    } else {
      result = await generateQuizPack({ title: title || "AI Generated Quiz Pack", sourceText, questionCount: count, difficulty: diff, includeExplanations: includeExplanations !== false, questionType: resolvedType, premium: req.isPremium === true });
    }

    const tokens = estimator.estimate(sourceText, JSON.stringify(result));
    const estimatedCostUsd = estimateTextCostUsd({ model, ...tokens });
    await recordAiEvent(logger.finish(track, { uid: req.user?.uid, model, cached: false, success: true, ...tokens, estimatedCostUsd }));
    return res.json(result);
  } catch (err) {
    await recordAiEvent(logger.finish(track, { uid: req.user?.uid, model, cached: false, success: false, error: err.message, estimatedCostUsd: 0 })).catch(() => {});
    console.error("[Quiz]", track.requestId, err.message);
    return res.status(500).json({ error: "Quiz generation failed" });
  }
});

module.exports = router;
