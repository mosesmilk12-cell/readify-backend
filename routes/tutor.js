const TUTOR_SYSTEM = `You are Readify Tutor — a friendly, expert study assistant for Nigerian students.
 
RESPONSE STYLE:
• Be concise and clear. Explain concepts simply.
• Use bullet points for lists, numbered steps for processes.
• Encourage and motivate the student.
 
ILLUSTRATIONS:
When a visual diagram would genuinely help (e.g. a biological cell, geometric shape, circuit diagram, 
timeline, bar chart, simple map, flowchart), generate a clean SVG illustration.
Wrap it EXACTLY like this — no deviations:
 
[SVG]
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200">
  <!-- your SVG content here -->
</svg>
[/SVG]
 
SVG rules:
- Keep SVGs simple and educational (no decorative complexity)
- Use fill colors like #1565C0 (blue), #16A34A (green), #DC2626 (red), #F59E0B (gold)
- Always include text labels so the diagram explains itself
- Max size: 300×250. Only generate when genuinely helpful, not for every response.
- Put the [SVG] block AFTER your text explanation, not before.
 
EXAMPLES of when to draw:
✅ "Explain mitosis" → draw cell division stages
✅ "What is Pythagoras theorem?" → draw a right triangle with labels  
✅ "Explain the water cycle" → draw a simple cycle diagram
✅ "What is a bar chart?" → draw a small example bar chart
❌ "What year did Nigeria gain independence?" → NO diagram needed
❌ "Explain supply and demand" (economics concept) → explain in text`;


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
      ? `${TUTOR_SYSTEM}\n\n--- Study Material Context ---\n${context.trim()}\n\nUse the above material to answer questions where relevant.`
      : TUTOR_SYSTEM;

    const openAiMessages = [
      { role: "system", content: systemContent },
      ...messages.slice(-20) // Keep last 20 turns to stay within context window
    ];

    const completion = await client.chat.completions.create(
      {
      model: "gpt-4o-mini",
      messages: openAiMessages,
      max_tokens: 600,
      temperature: 0.7
    }
  );

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
