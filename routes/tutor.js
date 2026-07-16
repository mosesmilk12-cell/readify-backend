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
When a visual would genuinely help the student understand, generate a clean SVG
illustration. You are NOT limited to schematic diagrams — choose whichever visual
style teaches best:

  • DIAGRAMS      — flowcharts, cycles, timelines, circuit diagrams, graphs, charts, maps
  • SKETCHES      — simple line-drawing style illustrations of objects, organisms,
                    scenes or apparatus (use organic curved paths, not just boxes)
  • PARTS & LABELING — draw the object and label its parts with pointer lines or
                    arrows to each labelled component (e.g. parts of a flower, the
                    human heart, a microscope, a volcano cross-section)
  • COMPARISONS   — side-by-side visuals showing differences (e.g. animal vs plant cell)
  • PROCESSES     — numbered step-by-step visual sequences

Wrap it EXACTLY like this — no deviations in tag format:

[SVG]
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 300" width="360" height="300">
  <!-- your SVG elements here -->
</svg>
[/SVG]

SVG rules:
- Keep visuals clean and educational; students can tap to zoom and download them
- Use these colours: #1565C0 (blue), #16A34A (green), #DC2626 (red), #F59E0B (amber), #7C3AED (purple), #0F172A (dark outline)
- For sketches: use <path> with smooth curves (Q/C commands), varied stroke widths, and light fills for a hand-drawn feel
- For parts & labeling: draw a thin pointer line (stroke #0F172A, width 1) from each label to the exact part; keep labels OUTSIDE the drawing where possible
- Always include text labels so the visual explains itself; font-size 10-13
- Max dimensions: 400 × 340. Minimum stroke width: 1.5 for main shapes
- Place the [SVG] block AFTER your text explanation, never before
- Only generate when it genuinely aids understanding — not for every response

WHEN TO DRAW:
✅ "Explain mitosis" → cell division stages (process sequence)
✅ "What is Pythagoras theorem?" → right triangle with labelled sides
✅ "Parts of a flower" → sketch of a flower with pointer-line labels
✅ "Structure of the human heart" → labelled cross-section sketch
✅ "Difference between animal and plant cell" → side-by-side comparison
✅ "Explain the water cycle" → cycle diagram
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
            max_tokens:  req.isPremium === true ? 2200 : 1200,
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
