require("dotenv").config();
const express = require("express");
const OpenAI  = require("openai");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { getCache, setCache } = require("../config/cache");
const { aiQueue, queueEvents } = require("../config/queue");

router.post("/summarize", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ summary: "No text provided." });
    }

    // Cache check
    const cached = await getCache("summary", text);
    if (cached) return res.json(cached);

    const prompt = `Summarize this study material for quick revision.\n\nRules:\n- Keep it SHORT and easy to read\n- Use bullet points\n- Max 6–10 lines\n- Focus only on important ideas\n\nFormat:\n• Key idea 1\n• Key idea 2\n\nText:\n${text.substring(0, 6000)}`;

    // Queue if Redis available, else direct
    if (aiQueue && queueEvents) {
      const job = await aiQueue.add("summary", { text, premium: req.isPremium === true });
      const result = await job.waitUntilFinished(queueEvents, 45_000);
      return res.json(result);
    }

    // Direct OpenAI call using chat.completions (universally supported)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Readify AI. Help students understand content quickly. Respond with plain bullet points only, no markdown symbols like ** or ##." },
        { role: "user", content: prompt }
      ],
      max_tokens: req.isPremium === true ? 1200 : 500,
    });

    const summary = completion.choices[0]?.message?.content || "No summary returned.";
    const result = { summary };
    await setCache("summary", result, text);
    return res.json(result);

  } catch (err) {
    console.error("[Summarize]", err.message);
    return res.status(500).json({ summary: "AI summary failed: " + err.message });
  }
});

module.exports = router;
