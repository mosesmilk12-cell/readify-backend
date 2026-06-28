require("dotenv").config();
const express = require("express");
const OpenAI  = require("openai");
const { getCache }     = require("../config/cache");
const { aiQueue, queueEvents } = require("../config/queue");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/summarize
 *
 * Flow:
 *  1. Check Redis cache — return immediately on hit (zero OpenAI cost)
 *  2. Queue the job via BullMQ and await result (max 5 concurrent OpenAI calls)
 *  3. If Redis is unavailable, call OpenAI directly as before
 */
router.post("/summarize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ summary: "No text provided." });
    }

    // ── 1. Cache hit? ────────────────────────────────────────────
    const cached = await getCache("summary", text);
    if (cached) {
      console.log("[Cache] HIT summary");
      return res.json(cached);
    }

    // ── 2. Queue (if Redis available) ────────────────────────────
    if (aiQueue && queueEvents) {
      const job = await aiQueue.add("summary", { text }, {
        jobId: `summary-${require("crypto").createHash("sha256").update(text).digest("hex").substring(0, 16)}`,
      });

      const result = await job.waitUntilFinished(queueEvents, 45_000);
      return res.json(result);
    }

    // ── 3. Direct fallback (no Redis) ────────────────────────────
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "You are Readify AI. Help students understand content quickly." },
        { role: "user",   content: `Summarize this study material for quick revision.\n\nRules:\n- Keep it SHORT and easy to read\n- Use bullet points\n- Max 6–10 lines\n- No long paragraphs\n- Focus only on important ideas\n\nFormat:\n• Key idea 1  \n• Key idea 2  \n• Key idea 3  \n\nText:\n${text}` },
      ],
    });

    return res.json({ summary: response.output_text || "No summary returned." });

  } catch (err) {
    console.error("[Summarize]", err.message);
    return res.status(500).json({ summary: "AI summary failed" });
  }
});

module.exports = router;
