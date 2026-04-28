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
            "You are Readify AI. Summarize study material clearly for students. Make the summary helpful, explanatory, and easy to revise from."
        },
        {
          role: "user",
          content:
            `Summarize this PDF page like a study note.\n\n` +
            `Use this structure:\n` +
            `1. Short overview\n` +
            `2. Key points\n` +
            `3. Important terms\n` +
            `4. What the student should remember\n\n` +
            `Text:\n${text}`
        }
      ]
    });

    const summary = response.output_text || "No summary returned.";

    return res.json({ summary });
  } catch (error) {
    console.error("summarize error:", error);
    return res.status(500).json({
      summary: "AI summary failed. Please try again."
    });
  }
});

app.use("/api", quizRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});