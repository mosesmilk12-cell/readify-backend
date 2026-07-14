require("dotenv").config();
const { Worker } = require("bullmq");
const OpenAI = require("openai");
const { redisForBullMQ } = require("../config/redis");
const { setCache, setTTSCache } = require("../config/cache");
const { schemaForQuestionType } = require("../utils/schema");

if (!redisForBullMQ) {
  console.warn("[Worker] Redis not configured — worker not started.");
  module.exports = null;
  return;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const worker = new Worker(
  "readify-ai",
  async (job) => {
    const { name, data } = job;

    // ── Summary ──
    if (name === "summary") {
      const { text, premium } = data;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are Readify AI. Summarize study material with plain bullet points. No markdown like ** or ##." },
          { role: "user",   content: `Summarize this for quick revision:\n\n${text.substring(0, 6000)}` }
        ],
        max_tokens: premium === true ? 1200 : 500,
      });
      const result = { summary: completion.choices[0]?.message?.content || "No summary returned." };
      await setCache("summary", result, text);
      return result;
    }

    // ── Quiz ──
    if (name === "quiz") {
      const { title, sourceText, questionCount, difficulty, questionType, premium } = data;
      const resolvedType = questionType || "MULTIPLE_CHOICE";
      const prompt = buildQuizPrompt({ questionType: resolvedType, questionCount, difficulty, sourceText });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Return only valid JSON matching the provided schema." },
          { role: "user",   content: prompt }
        ],
        max_tokens: premium === true ? 3000 : 1800,
        response_format: {
          type: "json_schema",
          json_schema: schemaForQuestionType(resolvedType),
        },
      });

      const result = JSON.parse(completion.choices[0].message.content);
      await setCache("quiz", result, sourceText, String(questionCount), difficulty, resolvedType);
      return result;
    }

    // ── TTS ──
    if (name === "tts") {
      const { text, voiceStyle } = data;
      const voices = { default:"alloy", male:"onyx", female:"nova", calm:"shimmer", energetic:"verse" };
      const voice  = voices[voiceStyle] || "alloy";

      const audio  = await openai.audio.speech.create({
        model: "tts-1",
        voice,
        input: text.substring(0, 4000),
      });

      const buffer = Buffer.from(await audio.arrayBuffer());
      await setTTSCache(text, voiceStyle || "default", buffer);
      return { audioBase64: buffer.toString("base64"), mimeType: "audio/mpeg" };
    }

    throw new Error(`Unknown job type: ${name}`);
  },
  { connection: redisForBullMQ, concurrency: 5 }
);

worker.on("completed", (job) => console.log(`[Worker] ${job.name} ${job.id} done`));
worker.on("failed",    (job, err) => console.error(`[Worker] ${job?.name} ${job?.id} failed:`, err.message));

console.log("[Worker] AI worker started (concurrency: 5)");
module.exports = worker;

function buildQuizPrompt({ questionType, questionCount, difficulty, sourceText }) {
  if (questionType === "TRUE_FALSE") {
    return `Generate ${questionCount} True/False questions. Difficulty: ${difficulty}.\nOptions must be exactly ["True","False"]. correctAnswerIndex: 0=true, 1=false.\n\nStudy material:\n${sourceText}`;
  }
  if (questionType === "SHORT_ANSWER") {
    return `Generate ${questionCount} fill-in-the-blank questions. Difficulty: ${difficulty}.\nEach question replaces one key word with "_____". modelAnswer is just that word/phrase.\n\nStudy material:\n${sourceText}`;
  }
  return `Generate ${questionCount} multiple-choice questions with 4 options each. Difficulty: ${difficulty}. Only one correct answer.\n\nStudy material:\n${sourceText}`;
}
