require("dotenv").config();
const { Worker } = require("bullmq");
const OpenAI = require("openai");
const { redisForBullMQ } = require("../config/redis");
const { setCache, setTTSCache } = require("../config/cache");
const { schemaForQuestionType } = require("../utils/schema");

/**
 * AI Worker — processes jobs off the "readify-ai" queue.
 *
 * Concurrency = 5: at most 5 simultaneous OpenAI API calls from this
 * process. Extra jobs wait in Redis until a slot opens.
 *
 * Each job returns a plain object (serialised through Redis):
 *   summary → { summary: "..." }
 *   quiz    → { title, questions: [...] }
 *   tts     → { audioBase64: "...", mimeType: "audio/mpeg" }
 *
 * After a successful call the result is also written back to the cache
 * so subsequent identical requests skip the queue entirely.
 */

if (!redisForBullMQ) {
  console.warn("[Worker] Redis not configured — worker not started.");
  module.exports = null;
  return;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VOICE_STYLES = {
  default:  { voice: "alloy",   instructions: "Speak clearly and naturally like a helpful study tutor." },
  male:     { voice: "onyx",    instructions: "Use a confident, calm male study tutor voice." },
  female:   { voice: "nova",    instructions: "Use a warm, clear female study tutor voice." },
  calm:     { voice: "shimmer", instructions: "Use a slow, calm, relaxing study voice." },
  energetic:{ voice: "verse",   instructions: "Use an energetic revision voice that keeps students engaged." },
};

const worker = new Worker(
  "readify-ai",
  async (job) => {
    const { name, data } = job;

    // ── Summary ──────────────────────────────────────────────────
    if (name === "summary") {
      const { text } = data;

      const response = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          {
            role: "system",
            content: "You are Readify AI. Help students understand content quickly.",
          },
          {
            role: "user",
            content: `Summarize this study material for quick revision.\n\nRules:\n- Keep it SHORT and easy to read\n- Use bullet points\n- Max 6–10 lines\n- No long paragraphs\n- Focus only on important ideas\n\nFormat:\n• Key idea 1  \n• Key idea 2  \n• Key idea 3  \n\nText:\n${text}`,
          },
        ],
      });

      const result = { summary: response.output_text || "No summary returned." };
      await setCache("summary", result, text);
      return result;
    }

    // ── Quiz ─────────────────────────────────────────────────────
    if (name === "quiz") {
      const { title, sourceText, questionCount, difficulty, questionType } = data;

      const resolvedType  = questionType || "MULTIPLE_CHOICE";
      const prompt        = buildQuizPrompt({ questionType: resolvedType, questionCount, difficulty, sourceText });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "developer", content: "Return only valid JSON matching the provided schema." },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: schemaForQuestionType(resolvedType),
        },
      });

      const result = JSON.parse(completion.choices[0].message.content);
      await setCache("quiz", result, sourceText, String(questionCount), difficulty, resolvedType);
      return result;
    }

    // ── TTS ──────────────────────────────────────────────────────
    if (name === "tts") {
      const { text, voiceStyle } = data;
      const selected = VOICE_STYLES[voiceStyle] || VOICE_STYLES.default;

      const audio = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: selected.voice,
        input: text.substring(0, 4000),
        instructions: selected.instructions,
      });

      const buffer = Buffer.from(await audio.arrayBuffer());
      await setTTSCache(text, voiceStyle || "default", buffer);

      return { audioBase64: buffer.toString("base64"), mimeType: "audio/mpeg" };
    }

    throw new Error(`Unknown job type: ${name}`);
  },
  {
    connection: redisForBullMQ,
    concurrency: 5,                   // ← the key setting: max 5 simultaneous OpenAI calls
    stalledInterval: 30_000,
    maxStalledCount: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`[Worker] ${job.name} job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] ${job?.name} job ${job?.id} failed:`, err.message);
});

// ── Quiz prompt builder (mirrors openaiService.js) ───────────────
function buildQuizPrompt({ questionType, questionCount, difficulty, sourceText }) {
  if (questionType === "TRUE_FALSE") {
    return `You are generating a True/False quiz pack for a study app.\nUse ONLY the provided study material.\nCreate exactly ${questionCount} True/False statements.\nDifficulty: ${difficulty}.\nEach question's "options" must be exactly ["True", "False"], in that order.\ncorrectAnswerIndex must be 0 if the statement is true, or 1 if it is false.\nRoughly half the statements should be true and half should be false.\nReturn short, clear explanations.\n\nStudy material:\n${sourceText}`;
  }
  if (questionType === "SHORT_ANSWER") {
    return `You are generating Fill-in-the-Blank quiz questions for a study app.\nUse ONLY the provided study material.\nCreate exactly ${questionCount} fill-in-the-blank questions.\nDifficulty: ${difficulty}.\nEach "question" must be a complete sentence with exactly ONE key word replaced by "_____".\nThe "modelAnswer" must be ONLY the single word or short phrase that fills that blank.\nReturn short, clear explanations.\n\nStudy material:\n${sourceText}`;
  }
  return `You are generating a quiz pack for a study app.\nUse ONLY the provided study material.\nCreate exactly ${questionCount} multiple-choice questions.\nDifficulty: ${difficulty}.\nEach question must have exactly 4 options. Only one is correct.\nReturn short, clear explanations.\n\nStudy material:\n${sourceText}`;
}

console.log("[Worker] AI worker started (concurrency: 5)");
module.exports = worker;
