require("dotenv").config();
const express = require("express");
const OpenAI = require("openai");
const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { getCache, setCache } = require("../config/cache");
const { aiQueue, queueEvents } = require("../config/queue");
const logger = require("../services/analytics/requestLogger");
const estimator = require("../services/analytics/tokenEstimator");
const { estimateTextCostUsd } = require("../services/analytics/costService");
const { recordAiEvent } = require("../services/analytics/metricsService");

router.post("/summarize", async (req, res) => {
  const track = logger.start("summary", req);
  const { text } = req.body || {};
  const model = "gpt-4o-mini";
  try {
    if (!text || !text.trim()) return res.status(400).json({ summary: "No text provided." });

    const cached = await getCache("summary", text);
    if (cached) {
      const tokens = estimator.estimate(text, cached.summary || "");
      await recordAiEvent(logger.finish(track, { uid: req.user?.uid, model, cached: true, success: true, ...tokens, estimatedCostUsd: 0 }));
      return res.json(cached);
    }

    let result;
    if (aiQueue && queueEvents) {
      const job = await aiQueue.add("summary", { text, premium: req.isPremium === true });
      result = await job.waitUntilFinished(queueEvents, 45_000);
    } else {
      const prompt = `Summarize this study material for quick revision.\n\nRules:\n- Keep it SHORT and easy to read\n- Use bullet points\n- Max 6–10 lines\n- Focus only on important ideas\n\nText:\n${text.substring(0, 6000)}`;
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You are Readify AI. Help students understand content quickly. Respond with plain bullet points only, no markdown symbols like ** or ##." },
          { role: "user", content: prompt }
        ],
        max_tokens: req.isPremium === true ? 1200 : 500,
      });
      result = { summary: completion.choices[0]?.message?.content || "No summary returned." };
      await setCache("summary", result, text);
    }

    const tokens = estimator.estimate(text, result.summary || "");
    const estimatedCostUsd = estimateTextCostUsd({ model, ...tokens });
    await recordAiEvent(logger.finish(track, { uid: req.user?.uid, model, cached: false, success: true, ...tokens, estimatedCostUsd }));
    return res.json(result);
  } catch (err) {
    await recordAiEvent(logger.finish(track, { uid: req.user?.uid, model, cached: false, success: false, error: err.message, estimatedCostUsd: 0 })).catch(() => {});
    console.error("[Summarize]", track.requestId, err.message);
    return res.status(500).json({ summary: "AI summary failed: " + err.message });
  }
});

module.exports = router;
