const express = require("express");
const router  = express.Router();
const OpenAI  = require("openai");
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ────────────────────────────────────────────────────────────────────────────
// POST /api/summarize
// Body: { text: string }
// Summarises a passage of text (extracted from a PDF page or page range).
// ────────────────────────────────────────────────────────────────────────────
router.post("/summarize", async (req, res) => {
    const { text } = req.body;

    if (!text || text.trim().length < 20) {
        return res.status(400).json({ error: "No text provided to summarise." });
    }

    try {
        const completion = await openai.chat.completions.create({
            model:      "gpt-4o-mini",
            max_tokens: req.body.premium === true ? 1600 : 800,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a study assistant helping Nigerian students. "
                        + "Summarise the given text into clear, concise bullet points. "
                        + "Use simple English. Focus on key concepts, definitions, and facts. "
                        + "Format: start each point with •",
                },
                {
                    role: "user",
                    content: `Summarise this:\n\n${text.substring(0, 6000)}`,
                },
            ],
        });

        const summary = completion.choices[0]?.message?.content?.trim() || "";
        if (!summary) return res.status(500).json({ error: "Empty summary returned." });

        return res.json({ summary });

    } catch (err) {
        console.error("[summarize]", err.message);
        return res.status(500).json({ error: "Summarisation failed. Please try again." });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/tts
// Body: { text: string, voice?: string }
// Returns an mp3 audio Buffer of the text spoken aloud.
// ────────────────────────────────────────────────────────────────────────────
router.post("/tts", async (req, res) => {
    const { text, voice = "alloy" } = req.body;

    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "No text provided for TTS." });
    }

    const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    const safeVoice   = VALID_VOICES.includes(voice) ? voice : "alloy";

    try {
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: safeVoice,
            input: text.substring(0, 4096),
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        res.set("Content-Type", "audio/mpeg");
        return res.send(buffer);

    } catch (err) {
        console.error("[tts]", err.message);
        return res.status(500).json({ error: "TTS failed. Please try again." });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/generate-quiz
// Body: { text: string, type?: "mcq"|"truefalse"|"fillinblank", count?: number }
// Generates quiz questions from study text.
// ────────────────────────────────────────────────────────────────────────────
router.post("/generate-quiz", async (req, res) => {
    const {
        text,
        type  = "mcq",
        count = 5,
    } = req.body;

    if (!text || text.trim().length < 30) {
        return res.status(400).json({ error: "Not enough text to generate a quiz." });
    }

    const numQuestions = Math.min(Math.max(parseInt(count) || 5, 1), 15);

    const typeInstruction = {
        mcq:         "multiple-choice questions (4 options each, label them A B C D, mark the correct one with ✓)",
        truefalse:   "true/false questions (state the answer clearly)",
        fillinblank: "fill-in-the-blank questions (replace the key word with ___)",
    }[type] || "multiple-choice questions (4 options each, mark correct with ✓)";

    try {
        const completion = await openai.chat.completions.create({
            model:      "gpt-4o-mini",
            max_tokens: req.body.premium === true ? 2600 : 1500,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a quiz generator for Nigerian students. "
                        + "Generate exactly the number of questions requested. "
                        + "Return ONLY valid JSON — no markdown, no backticks, no extra text. "
                        + "Schema: { \"questions\": [ { \"question\": \"...\", \"options\": [\"A. ...\",\"B. ...\",\"C. ...\",\"D. ...\"], \"answer\": \"A\" } ] } "
                        + "For true/false: options=[\"True\",\"False\"], answer=\"True\" or \"False\". "
                        + "For fill-in-blank: options=[], answer=\"the correct word\".",
                },
                {
                    role: "user",
                    content:
                        `Generate ${numQuestions} ${typeInstruction} from this text:\n\n`
                        + text.substring(0, 5000),
                },
            ],
        });

        let raw = completion.choices[0]?.message?.content?.trim() || "";

        // Strip any accidental markdown fences
        raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            console.error("[generate-quiz] JSON parse failed:", raw.substring(0, 200));
            return res.status(500).json({ error: "Quiz generation returned invalid data. Please try again." });
        }

        return res.json(parsed);

    } catch (err) {
        console.error("[generate-quiz]", err.message);
        return res.status(500).json({ error: "Quiz generation failed. Please try again." });
    }
});

module.exports = router;
