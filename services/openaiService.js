require("dotenv").config();

const OpenAI = require("openai");
const { schemaForQuestionType } = require("../utils/schema");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function buildPrompt({ questionType, questionCount, difficulty, sourceText }) {
  if (questionType === "TRUE_FALSE") {
    return `
You are generating a True/False quiz pack for a study app.

Use ONLY the provided study material.
Create exactly ${questionCount} True/False statements.
Difficulty: ${difficulty}.
Each question's "options" must be exactly ["True", "False"], in that order.
correctAnswerIndex must be 0 if the statement is true, or 1 if it is false.
Roughly half the statements should be true and half should be false.
Return short, clear explanations.
Do not invent facts not found in the material.

Study material:
${sourceText}
`;
  }

  if (questionType === "SHORT_ANSWER") {
    return `
You are generating Fill-in-the-Blank quiz questions for a study app.

Use ONLY the provided study material.
Create exactly ${questionCount} fill-in-the-blank questions.
Difficulty: ${difficulty}.
Each "question" must be a complete sentence taken from or closely based on
the study material, with exactly ONE key word or short phrase replaced by
a blank written as "_____" (five underscores).
The "modelAnswer" must be ONLY the single word or short phrase that fills
that blank - never a full sentence, and never more than a few words.
Pick a word or phrase that is central to the sentence's meaning (a key
term, name, number, or concept) - never a trivial word like "the" or "and".
Return short, clear explanations.
Do not invent facts not found in the material.

Study material:
${sourceText}
`;
  }

  return `
You are generating a quiz pack for a study app.

Use ONLY the provided study material.
Create exactly ${questionCount} multiple-choice questions.
Difficulty: ${difficulty}.
Each question must have exactly 4 options.
Only one option is correct.
Return short, clear explanations.
Do not invent facts not found in the material.

Study material:
${sourceText}
`;
}

async function generateQuizPack({ title, sourceText, questionCount, difficulty, includeExplanations, questionType, premium }) {
  const resolvedType = questionType || "MULTIPLE_CHOICE";
  const prompt = buildPrompt({ questionType: resolvedType, questionCount, difficulty, sourceText });

  const response = await client.chat.completions.create({
        max_tokens: premium === true ? 3000 : 1800,
    model: "gpt-4o-mini",
    messages: [
      {
        role: "developer",
        content: "Return only valid JSON matching the provided schema."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: schemaForQuestionType(resolvedType)
    }
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  return JSON.parse(content);
}

module.exports = { generateQuizPack };
