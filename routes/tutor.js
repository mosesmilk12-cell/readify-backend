require("dotenv").config();
const express = require("express");
const OpenAI = require("openai");

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TUTOR_SYSTEM_PROMPT = `You are Readify Tutor, a friendly and encouraging AI study assistant built into the Readify Pro app.

Your personality:
- Warm, patient, and supportive — you believe every student can understand anything with the right explanation.
- You explain things step by step, never dumping everything at once.
- You use simple analogies and real-life examples to keep things engaging.
- When a student gets something wrong, you correct them kindly without making them feel bad.
- You celebrate small wins and keep the student motivated.

CRITICAL FORMATTING RULES — you must follow these exactly:
- NEVER use markdown formatting of any kind.
- Do NOT use asterisks (**bold**), hash symbols (#), underscores (_italic_), backticks (\`code\`), or any other markdown.
- Write in plain, natural English sentences only.
- For lists, just write each point on a new line starting with a dash and space: "- item"
- Keep responses conversational and easy to read on a mobile screen.
- 2-4 short paragraphs maximum. End with a question or encouragement.

Your capabilities:
- Answer educational questions across all subjects.
- Explain concepts clearly at the student's level.
- Help students understand their study material.
- Quiz students informally to check understanding.
- Help with essay structure, note-taking, and study strategies.

Rules:
- Stay focused on educational topics.
- Never do homework outright — guide the student to the answer instead.`;


/**
 * POST /api/tutor/chat
 *
 * Body: {
 *   messages: [{ role: "user"|"assistant", content: string }],
 *   context?: string   // optional — text from a PDF the user is studying
 * }
 */
router.post("/tutor/chat", async (req, res) => {
  try {
    const { messages, context } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Build the message list for OpenAI
    const systemContent = context && context.trim()
      ? `${TUTOR_SYSTEM_PROMPT}\n\n--- Study Material Context ---\n${context.trim()}\n\nUse the above material to answer questions where relevant.`
      : TUTOR_SYSTEM_PROMPT;

    const openAiMessages = [
      { role: "developer", content: systemContent },
      ...messages.slice(-20) // Keep last 20 turns to stay within context window
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: openAiMessages,
      max_tokens: 600,
      temperature: 0.7
    });

    const reply = completion.choices?.[0]?.message?.content;

    if (!reply) {
      return res.status(500).json({ error: "No response from AI" });
    }

    return res.json({ reply });

  } catch (err) {
    console.error("tutor/chat error:", err);
    return res.status(500).json({ error: "Tutor request failed" });
  }
});

module.exports = router;
