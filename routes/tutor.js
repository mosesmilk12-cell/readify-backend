const express = require("express");
const router  = express.Router();
const OpenAI  = require("openai");
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── System prompt ─────────────────────────────────────────────────────────────
const TUTOR_SYSTEM = `You are Readify Tutor — a friendly, expert study assistant for Nigerian students.

RESPONSE STYLE:
• Be concise and clear. Explain concepts in simple English.
• Use bullet points for lists, numbered steps for processes.
• Encourage the student. Keep energy positive.
• Keep responses focused — don't pad with unnecessary text.

ILLUSTRATIONS:
When a visual diagram would genuinely help the student understand (e.g. a biological cell,
geometric shape, circuit diagram, timeline, bar chart, simple map, or flowchart), generate
a clean SVG illustration. Wrap it EXACTLY like this — no deviations in tag format:

[SVG]
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 220" width="300" height="220">
  <!-- your SVG elements here -->
</svg>
[/SVG]

SVG rules:
- Keep diagrams simple, clean and educational
- Use these colours: #1565C0 (blue), #16A34A (green), #DC2626 (red), #F59E0B (amber), #7C3AED (purple)
- Always include text labels so the diagram explains itself without extra description
- Max dimensions: 300 × 250. Minimum stroke width: 1.5
- Place the [SVG] block AFTER your text explanation, never before
- Only generate when it genuinely aids understanding — not for every response

WHEN TO DRAW:
✅ "Explain mitosis" → cell division stages
✅ "What is Pythagoras theorem?" → right triangle with labelled sides
✅ "Explain the water cycle" → simple cycle diagram
✅ "What is a bar chart?" → small example bar chart
✅ "Draw a simple circuit" → battery, wire, bulb diagram
✅ "Explain the layers of the atmosphere" → vertical layer diagram
❌ "What year did Nigeria gain independence?" → text only
❌ "Define democracy" → text only`;

// ────────────────────────────────────────────────────────────────────────────
// POST /api/tutor/chat
// Body: { messages: [{role, content}], context?: string, illustration_mode?: bool }
// Returns: { reply: string }
// ────────────────────────────────────────────────────────────────────────────
router.post("/tutor/chat", async (req, res) => {
    const {
        messages         = [],
        context          = "",
        illustration_mode = false,
    } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "No messages provided." });
    }

    // Build the message array for OpenAI
    const systemMessages = [];

    // 1. Base system prompt
    systemMessages.push({
        role:    "system",
        content: illustration_mode ? TUTOR_SYSTEM : TUTOR_SYSTEM.split("\nILLUSTRATIONS:")[0].trim(),
    });

    // 2. Optional PDF context injected as a system message
    if (context && context.trim().length > 0) {
        systemMessages.push({
            role: "system",
            content:
                "The student is currently reading a document. Here is the relevant excerpt "
                + "(use it to inform your answers if relevant):\n\n"
                + context.substring(0, 3000),
        });
    }

    // Validate and sanitise the conversation history
    const validRoles     = new Set(["user", "assistant"]);
    const safeMessages   = messages
        .filter(m => m && validRoles.has(m.role) && typeof m.content === "string")
        .slice(-20);  // Keep last 20 turns to stay within token budget

    if (safeMessages.length === 0) {
        return res.status(400).json({ error: "No valid messages after filtering." });
    }

    try {
        const completion = await openai.chat.completions.create({
            model:       "gpt-4o-mini",
            max_tokens:  1200,
            temperature: 0.7,
            messages: [
                ...systemMessages,
                ...safeMessages,
            ],
        });

        const reply = completion.choices[0]?.message?.content?.trim() || "";
        if (!reply) return res.status(500).json({ error: "Empty response from AI." });

        return res.json({ reply });

    } catch (err) {
        console.error("[tutor/chat]", err.message);
        return res.status(500).json({ error: "Tutor is unavailable right now. Please try again." });
    }
});

module.exports = router;
