require("dotenv").config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const express = require("express");
const cors = require("cors");
const quizRoutes = require("./routes/quiz");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({ message: "Readify backend is running" });
});

app.post("/api/summarize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ summary: "No text provided." });
    }

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You are Readify AI. Help students understand content quickly."
        },
        {
          role: "user",
          content:
            `Summarize this study material for quick revision.

Rules:
- Keep it SHORT and easy to read
- Use bullet points
- Max 6–8 lines
- No long paragraphs
- Focus only on important ideas

Format:
• Key idea 1  
• Key idea 2  
• Key idea 3  

Text:
${text}`
        }
      ]
    });

    const summary = response.output_text || "No summary returned.";

    return res.json({ summary });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      summary: "AI summary failed"
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceStyle } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required." });
    }

    const styles = {
      default: {
        voice: "alloy",
        instructions: "Speak clearly and naturally like a helpful study tutor."
      },
      male: {
        voice: "onyx",
        instructions: "Use a confident, calm male study tutor voice."
      },
      female: {
        voice: "nova",
        instructions: "Use a warm, clear female study tutor voice."
      },
      calm: {
        voice: "shimmer",
        instructions: "Use a slow, calm, relaxing study voice."
      },
      energetic: {
        voice: "verse",
        instructions: "Use an energetic revision voice that keeps students engaged."
      }
    };

    const selected = styles[voiceStyle] || styles.default;

    const audio = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: selected.voice,
      input: text.substring(0, 4000),
      instructions: selected.instructions
    });

    const buffer = Buffer.from(await audio.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (error) {
    console.error("tts error:", error);
    res.status(500).json({ error: "AI voice generation failed." });
  }
});

app.use("/api", quizRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});