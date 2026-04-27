const express = require("express");
const router = express.Router();
const { generateQuizPack } = require("../services/openaiService");

router.post("/generate-quiz", async (req, res) => {
  try {
    const { title, sourceText, questionCount, difficulty, includeExplanations } = req.body;

    if (!sourceText || !sourceText.trim()) {
      return res.status(400).json({ error: "sourceText is required" });
    }

    const result = await generateQuizPack({
      title: title || "AI Generated Quiz Pack",
      sourceText,
      questionCount: Number(questionCount) || 10,
      difficulty: difficulty || "Medium",
      includeExplanations: includeExplanations !== false
    });

    return res.json(result);
  } catch (error) {
    console.error("generate-quiz error:", error);
    return res.status(500).json({
      error: "Quiz generation failed"
    });
  }
});

module.exports = router;