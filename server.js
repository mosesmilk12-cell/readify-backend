require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const { exec } = require("child_process");
const requireAuth = require("./middleware/requireAuth");

// ── Startup environment check ──────────────────────────────────────
// Logs clearly in Render so you can see immediately what's missing
const required = ["OPENAI_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON"];
const optional = [
  "REDIS_URL",
  "MONNIFY_SECRET_KEY",
  "CLOUDCONVERT_API_KEY",
  "ALLOWED_ORIGINS",
  "PUBLIC_BACKEND_URL",
  "WEB_APP_URL",
];

console.log("\n=== Readify Backend Startup ===");
required.forEach(k => {
  if (!process.env[k]) {
    console.error(`❌ MISSING REQUIRED ENV VAR: ${k} — AI features will FAIL without this`);
  } else {
    console.log(`✅ ${k} is set`);
  }
});
optional.forEach(k => {
  console.log(`${process.env[k] ? "✅" : "⚠️ "} ${k}: ${process.env[k] ? "set" : "not set (optional)"}`);
});
console.log("================================\n");

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

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://readifypro.com.ng,https://www.readifypro.com.ng,http://localhost:3000,http://localhost:8080")
  .split(",").map(value => value.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({ message: "Readify backend is running" });
});

// Subscription router must be mounted first: its Monnify callback is public,
// while init-payment and verify-payment apply requireAuth inside the router.
app.use("/api", subscriptionRoutes);

// ── Signed-in app routes ──────────────────────────────────────────
const protectedApi = express.Router();
protectedApi.use(requireAuth);
protectedApi.use(summarizeRoutes);
protectedApi.use(ttsRoutes);
protectedApi.use(quizRoutes);
protectedApi.use(convertRoutes);
protectedApi.use(tutorRoutes);
app.use("/api", protectedApi);

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
