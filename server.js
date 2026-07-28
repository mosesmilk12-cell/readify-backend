require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const { exec } = require("child_process");
const requireAuth = require("./middleware/requireAuth");
const requestTracking = require("./middleware/requestTracking");
const usageRoutes     = require("./routes/usage");
const adminRoutes     = require("./routes/admin");
const enforceBudget   = require("./middleware/enforceBudget");

// ── Startup environment check ──────────────────────────────────────
// Logs clearly in Render so you can see immediately what's missing
const required = ["OPENAI_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON"];
const optional = [
  "REDIS_URL",
  "MONNIFY_SECRET_KEY",
  "PAYSTACK_SECRET_KEY",
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

// Subscription routes are mounted first because payment callbacks are public,
// while starting and verifying a payment still require Firebase authentication.
app.use("/api", subscriptionRoutes);

// ── Signed-in app routes ──────────────────────────────────────────
const protectedApi = express.Router();
protectedApi.use(requireAuth);
protectedApi.use(requestTracking);

// Routes that spend money at OpenAI sit behind the budget guard.
protectedApi.use(enforceBudget, summarizeRoutes);
protectedApi.use(enforceBudget, ttsRoutes);
protectedApi.use(enforceBudget, quizRoutes);
protectedApi.use(enforceBudget, tutorRoutes);

// Document conversion is local (LibreOffice), and the usage/admin endpoints are
// read-only — none of them cost anything, so the ceiling must not block them.
protectedApi.use(convertRoutes);
protectedApi.use(usageRoutes);
protectedApi.use(adminRoutes);
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
