require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const { exec } = require("child_process");

// ── Routes ──────────────────────────────────────────────────────
const summarizeRoutes    = require("./routes/summarize");
const ttsRoutes          = require("./routes/tts");
const quizRoutes         = require("./routes/quiz");
const convertRoutes      = require("./routes/convert");
const subscriptionRoutes = require("./routes/subscription");
const tutorRoutes        = require("./routes/tutor");

// ── Redis queue worker (starts concurrency-5 processor if Redis configured) ──
require("./queues/aiWorker");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({ message: "Readify backend is running" });
});

// ── AI routes (all now cache-aware + queue-backed) ───────────────
app.use("/api", summarizeRoutes);
app.use("/api", ttsRoutes);
app.use("/api", quizRoutes);

// ── Other routes ─────────────────────────────────────────────────
app.use("/api", convertRoutes);
app.use("/api", subscriptionRoutes);
app.use("/api", tutorRoutes);

app.get("/api/check-libreoffice", (req, res) => {
  const isWindows = process.platform === "win32";
  const command   = isWindows
    ? "where soffice && soffice --version"
    : "which soffice && soffice --version";

  exec(command, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ ok: false, error: error.message, stderr });
    res.json({ ok: true, output: stdout });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
