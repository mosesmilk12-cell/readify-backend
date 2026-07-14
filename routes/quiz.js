const express  = require("express");
const crypto   = require("crypto");
const router   = express.Router();
const { generateQuizPack }     = require("../services/openaiService");
const { getCache }             = require("../config/cache");
const { aiQueue, queueEvents } = require("../config/queue");

/**
 * POST /api/generate-quiz
 *
 * Flow:
 *  1. Cache hit  → return instantly (same text + same params = same quiz)
 *  2. Queue      → awaits worker result (max 5 concurrent OpenAI calls)
 *  3. Direct     → fallback when Redis unavailable
 */
router.post("/generate-quiz", async (req, res) => {
  try {
    const { title, sourceText, questionCount, difficulty, includeExplanations, questionType } = req.body;

    if (!sourceText || !sourceText.trim()) {
      return res.status(400).json({ error: "sourceText is required" });
    }

    const allowedTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];
    const resolvedType = allowedTypes.includes(questionType) ? questionType : "MULTIPLE_CHOICE";
    const count        = Math.min(60, Math.max(1, Number(questionCount) || 10));
    const diff         = difficulty || "Medium";

    // ── 1. Cache hit? ──────────────────────────────────────────
    const cached = await getCache("quiz", sourceText, String(count), diff, resolvedType);
    if (cached) {
      console.log("[Cache] HIT quiz");
      return res.json(cached);
    }

    // ── 2. Queue (if Redis available) ──────────────────────────
    if (aiQueue && queueEvents) {
      // Use a deterministic job ID so duplicate requests share one job
      const jobId = "quiz-" + crypto
        .createHash("sha256")
        .update(`${sourceText}|${count}|${diff}|${resolvedType}`)
        .digest("hex")
        .substring(0, 20);

      const job = await aiQueue.add(
        "quiz",
        { title: title || "AI Generated Quiz Pack", sourceText, questionCount: count, difficulty: diff, questionType: resolvedType, premium: req.isPremium === true },
        { jobId }
      );

      const result = await job.waitUntilFinished(queueEvents, 90_000);
      return res.json(result);
    }

    // ── 3. Direct fallback ─────────────────────────────────────
    const result = await generateQuizPack({
      title: title || "AI Generated Quiz Pack",
      sourceText,
      questionCount: count,
      difficulty: diff,
      includeExplanations: includeExplanations !== false,
      questionType: resolvedType,
      premium: req.isPremium === true,
    });

    return res.json(result);

  } catch (err) {
    console.error("[Quiz]", err.message);
    return res.status(500).json({ error: "Quiz generation failed" });
  }
});

module.exports = router;
