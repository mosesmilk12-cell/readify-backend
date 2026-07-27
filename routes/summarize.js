require("dotenv").config();
const express = require("express");
const OpenAI = require("openai");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { getCache, setCache } = require("../config/cache");
const { aiQueue, queueEvents } = require("../config/queue");
const { estimate } = require("../services/analytics/tokenEstimator");
const { estimateCostUsd } = require("../services/analytics/costService");
const { recordAiMetric } = require("../services/analytics/metricsService");
const { createRequestTracker } = require("../services/analytics/requestLogger");

const MODEL = "gpt-4o-mini";

router.post("/summarize", async (req, res) => {
  const tracker = createRequestTracker("summary");
  res.set("X-AI-Request-ID", tracker.requestId);

  let prompt = "";
  let text = "";

  try {
    text = req.body?.text || "";
    if (!text.trim()) {
      return res.status(400).json({ summary: "No text provided." });
    }

    const cached = await getCache("summary", text);
    if (cached) {
      const usage = estimate(text, cached.summary || "");
      await recordAiMetric({
        requestId: tracker.requestId,
        uid: req.user?.uid,
        feature: "summary",
        model: MODEL,
        cached: true,
        success: true,
        durationMs: tracker.durationMs(),
        ...usage,
        estimatedCostUsd: 0,
      });
      return res.json(cached);
    }

    prompt = `Summarize this study material for quick revision.\n\nRules:\n- Keep it SHORT and easy to read\n- Use bullet points\n- Max 6–10 lines\n- Focus only on important ideas\n\nFormat:\n• Key idea 1\n• Key idea 2\n\nText:\n${text.substring(0, 6000)}`;

    let result;
    let usage;

    if (aiQueue && queueEvents) {
      const job = await aiQueue.add("summary", {
        text,
        premium: req.isPremium === true,
      });
      result = await job.waitUntilFinished(queueEvents, 45_000);
      usage = estimate(prompt, result?.summary || "");
    } else {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "You are Readify AI. Help students understand content quickly. Respond with plain bullet points only, no markdown symbols like ** or ##.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: req.isPremium === true ? 1200 : 500,
      });

      const summary = completion.choices[0]?.message?.content || "No summary returned.";
      result = { summary };
      usage = completion.usage
        ? {
            inputTokens: completion.usage.prompt_tokens || 0,
            outputTokens: completion.usage.completion_tokens || 0,
            totalTokens: completion.usage.total_tokens || 0,
          }
        : estimate(prompt, summary);
      await setCache("summary", result, text);
    }

    await recordAiMetric({
      requestId: tracker.requestId,
      uid: req.user?.uid,
      feature: "summary",
      model: MODEL,
      cached: false,
      success: true,
      durationMs: tracker.durationMs(),
      ...usage,
      estimatedCostUsd: estimateCostUsd({ model: MODEL, ...usage }),
    });

    return res.json(result);
  } catch (err) {
    const usage = estimate(prompt || text, "");
    await recordAiMetric({
      requestId: tracker.requestId,
      uid: req.user?.uid,
      feature: "summary",
      model: MODEL,
      cached: false,
      success: false,
      durationMs: tracker.durationMs(),
      ...usage,
      estimatedCostUsd: 0,
      errorCode: err.code || err.name || "SUMMARY_ERROR",
    });
    console.error(`[Summarize][${tracker.requestId}]`, err.message);
    return res.status(500).json({ summary: "AI summary failed: " + err.message });
  }
});

module.exports = router;
