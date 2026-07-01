require("dotenv").config();
const express = require("express");
const OpenAI  = require("openai");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { getTTSCache, setTTSCache } = require("../config/cache");
const { aiQueue, queueEvents }     = require("../config/queue");

const VOICE_STYLES = {
  default:   { voice: "alloy",   instructions: "Speak clearly and naturally like a helpful study tutor." },
  male:      { voice: "onyx",    instructions: "Use a confident, calm male study tutor voice." },
  female:    { voice: "nova",    instructions: "Use a warm, clear female study tutor voice." },
  calm:      { voice: "shimmer", instructions: "Use a slow, calm, relaxing study voice." },
  energetic: { voice: "verse",   instructions: "Use an energetic revision voice that keeps students engaged." },
};

router.post("/tts", async (req, res) => {
  try {
    const { text, voiceStyle } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required." });
    }

    const style = VOICE_STYLES[voiceStyle] || VOICE_STYLES.default;

    // Cache check
    const cachedBuffer = await getTTSCache(text, voiceStyle || "default");
    if (cachedBuffer) {
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(cachedBuffer);
    }

    // Queue if Redis available, else direct
    if (aiQueue && queueEvents) {
      const job = await aiQueue.add("tts", { text, voiceStyle: voiceStyle || "default" });
      const result = await job.waitUntilFinished(queueEvents, 60_000);
      const buffer = Buffer.from(result.audioBase64, "base64");
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(buffer);
    }

    // Direct call
    const audio = await openai.audio.speech.create({
      model: "tts-1",
      voice: style.voice,
      input: text.substring(0, 4000),
    });

    const buffer = Buffer.from(await audio.arrayBuffer());
    await setTTSCache(text, voiceStyle || "default", buffer);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(buffer);

  } catch (err) {
    console.error("[TTS]", err.message);
    return res.status(500).json({ error: "AI voice generation failed: " + err.message });
  }
});

module.exports = router;
