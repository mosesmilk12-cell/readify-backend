require("dotenv").config();

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

    const summary = text.length > 500
      ? text.substring(0, 500) + "..."
      : text;

    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ summary: "Summary generation failed." });
  }
});

app.use("/api", quizRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});