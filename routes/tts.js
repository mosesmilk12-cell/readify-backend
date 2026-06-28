require("dotenv").config();
const express = require("express");
const OpenAI  = require("openai");
const { getTTSCache }          = require("../config/cache");
const { aiQueue, queueEvents } = require("../config/queue");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VOICE_STYLES = {
  default:  { voice: "alloy",   instructions: "Speak clearly and naturally like a helpful study tutor." },
  male:     { voice: "onyx",    instructions: "Use a confident, calm male study tutor voice." },
  female:   { voice: "nova",    instructions: "Use a warm, clear female study tutor voice." },
  calm:     { voice: "shimmer", instructions: "Use a slow, calm, relaxing study voice." },
  energetic:{ voice: "verse",   instructions: "Use an energetic revision voice that keeps students engaged." },
};

/**
 * POST /api/tts
 *
 * Flow:
 *  1. Cache hit → send cached audio buffer immediately (same page, same voice = instant)
 *  2. Queue → awaits result, decodes base64 → sends MP3
 *  3. Direct fallback when Redis unavailable
 */
router.post("/tts", async (req, res) => {
  try {
    const { text, voiceStyle } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required." });
    }

    const normalizedStyle = voiceStyle || "default";

    // ── 1. Cache hit? ────────────────────────────────────────────
    const cachedBuffer = await getTTSCache(text, normalizedStyle);
    if (cachedBuffer) {
      console.log("[Cache] HIT tts");
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Cache", "HIT");
      return res.send(cachedBuffer);
    }

    // ── 2. Queue (if Redis available) ────────────────────────────
    if (aiQueue && queueEvents) {
      const job = await aiQueue.add("tts", { text, voiceStyle: normalizedStyle });
      const result = await job.waitUntilFinished(queueEvents, 60_000);
      const buffer = Buffer.from(result.audioBase64, "base64");
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(buffer);
    }

    // ── 3. Direct fallback ───────────────────────────────────────
    const selected = VOICE_STYLES[normalizedStyle] || VOICE_STYLES.default;

    const audio = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: selected.voice,
      input: text.substring(0, 4000),
      instructions: selected.instructions,
    });

    const buffer = Buffer.from(await audio.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(buffer);

  } catch (err) {
    console.error("[TTS]", err.message);
    return res.status(500).json({ error: "AI voice generation failed." });
  }
});

module.exports = router;
